/**
 * /api/v2/inference/service/* — gateway-facing resolve + invalidate.
 *
 * Same token as the grant exchange. Resolve is the same authority the
 * user-facing /resolve uses, plus a minted grant on managed BYOK.
 */

import express from 'express';
import { resolveInferenceRoute, markCredentialInvalid, byokEnabled } from '../services/providerCredentials.js';
import { attachManagedGrant, recordGrantUsage } from '../services/inferenceGrants.js';
import { requireGrantToken, requireTls, sendGrantError } from './inferenceGrantAuth.js';

const router = express.Router();
router.use(requireGrantToken);
router.use(requireTls);

router.post('/resolve', async (req, res) => {
  const b = req.body || {};
  if (!b.userId) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId required' } });
  }
  try {
    const decision = await resolveInferenceRoute(req.db, b.userId, {
      surface: b.surface,
      requestedPath: b.requestedPath || null,
      model: typeof b.model === 'string' ? b.model : null,
    });
    const attached = await attachManagedGrant(req.db, b.userId, decision, {
      surface: b.surface,
      model: b.model,
    });
    return res.json(attached);
  } catch (e) { sendGrantError(res, e); }
});

router.post('/invalidate', async (req, res) => {
  const id = req.body && req.body.credentialId;
  if (!id) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'credentialId required' } });
  try {
    await markCredentialInvalid(req.db, id);
    return res.json({ invalidated: true, enabled: byokEnabled() });
  } catch (e) { sendGrantError(res, e); }
});

/**
 * POST /usage — record a BYOK completion's usage against the grant that carried
 * it (spec D4). Unbilled by construction; bound to a spent grant so the service
 * token cannot attribute free usage to anyone it likes. Same transport rules as
 * the exchange: grant token + confidential transport.
 *
 * Body: { grant, model?, provider?, inputTokens?, outputTokens?, operation? }
 *   200 { recorded: true,  duplicate: false, grantId, userId, surface }
 *   200 { recorded: false, duplicate: true,  grantId }   — retry-safe
 *   409 { error: { code: 'grant_unknown' | 'grant_unspent' } }
 */
router.post('/usage', async (req, res) => {
  const b = req.body || {};
  if (!b.grant || typeof b.grant !== 'string') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'grant required' } });
  }
  try {
    const result = await recordGrantUsage(req.db, b.grant, {
      model: b.model, provider: b.provider, operation: b.operation,
      inputTokens: Number.isInteger(b.inputTokens) ? b.inputTokens : undefined,
      outputTokens: Number.isInteger(b.outputTokens) ? b.outputTokens : undefined,
    });
    return res.json(result);
  } catch (e) { sendGrantError(res, e); }
});

export default router;
