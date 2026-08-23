/**
 * /api/v2/inference/service/* — gateway-facing resolve + invalidate.
 *
 * Same token as the grant exchange. Resolve is the same authority the
 * user-facing /resolve uses, plus a minted grant on managed BYOK.
 */

import express from 'express';
import { resolveInferenceRoute, markCredentialInvalid, byokEnabled } from '../services/providerCredentials.js';
import { attachManagedGrant } from '../services/inferenceGrants.js';
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

export default router;
