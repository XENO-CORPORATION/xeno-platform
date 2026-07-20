/**
 * /api/v2/ledger/service/* — SERVICE-authenticated ledger surface.
 *
 * A trusted backend service (e.g. xeno-agents-api) places/settles/voids credit
 * holds ON BEHALF OF a specified user, using a shared service token — WITHOUT
 * the user's own OIDC session. Every request carries an explicit `userId` in the
 * body; the caller can act on ANY user, so the bearer token is a HIGH-VALUE
 * secret (constant-time compared, never logged, fail-closed when unset).
 *
 * Deliberately SEPARATE from the user-facing `src/server/routes/v2LedgerRoutes.js`
 * (byte-unchanged, audited). It reuses the SAME ledger engine (holdV2 /
 * settleHoldV2 / voidHoldV2 in ../utils/creditLedgerV2.js) and the SAME HTTP
 * error taxonomy (402 insufficient, 403 frozen, 404 not found, 409 conflict).
 *
 * Auth: `Authorization: Bearer <LEDGER_SERVICE_TOKEN>` where the expected value
 * is process.env.LEDGER_SERVICE_TOKEN. If that env is unset/empty the router
 * refuses ALL requests (401) — it NEVER opens.
 *
 * Mounted with databaseMiddleware (req.db = pg pool) but WITHOUT authMiddleware
 * (there is no req.user) — service auth lives entirely in this file.
 */
import express from 'express';
import crypto from 'node:crypto';
import { holdV2, settleHoldV2, voidHoldV2 } from '../utils/creditLedgerV2.js';

const router = express.Router();

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

function unauthorized(res) {
  return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
}

/**
 * Constant-time bearer-token gate. Fail-closed: an unset/empty
 * LEDGER_SERVICE_TOKEN rejects every request (the router is never open).
 * timingSafeEqual requires equal-length buffers, so we length-guard first.
 */
function requireServiceToken(req, res, next) {
  const expected = process.env.LEDGER_SERVICE_TOKEN;
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
}

router.use(requireServiceToken);

// POST /api/v2/ledger/service/holds — reserve on behalf of userId. Idempotent on holdId.
router.post('/holds', async (req, res) => {
  const b = req.body || {};
  const { userId, holdId, amountMicro, operation, surface } = b;
  if (!userId || !holdId || !amountMicro || !operation || !surface) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId, holdId, amountMicro, operation, surface required' } });
  }
  try {
    res.json(await holdV2(req.db, userId, {
      surface,
      holdId,
      amountMicro,
      operation,
      expiresInSeconds: b.expiresInSeconds ?? 3600,
    }));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/service/holds/:holdId/settle — debit actual, release remainder.
router.post('/holds/:holdId/settle', async (req, res) => {
  const b = req.body || {};
  if (!b.userId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId required' } });
  }
  try {
    res.json(await settleHoldV2(req.db, b.userId, req.params.holdId, b.actualCostMicro ?? 0));
  } catch (err) {
    sendErr(res, err);
  }
});

// POST /api/v2/ledger/service/holds/:holdId/void — release without charging.
router.post('/holds/:holdId/void', async (req, res) => {
  const b = req.body || {};
  if (!b.userId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId required' } });
  }
  try {
    res.json(await voidHoldV2(req.db, b.userId, req.params.holdId));
  } catch (err) {
    sendErr(res, err);
  }
});

export default router;
