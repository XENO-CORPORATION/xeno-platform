/**
 * POST /api/v2/inference/credential
 *
 * Spec §6. Service token, TLS, { grant } → { provider, baseUrl, secret }.
 * Cache-Control: no-store. Second use → 410 grant_spent.
 *
 * 🔴 The 200 body IS the secret, for one hop. Never log req.body or this
 * response. The user-facing vault router must never grow a sibling of this.
 */

import express from 'express';
import { exchangeGrant } from '../services/inferenceGrants.js';
import { requireGrantToken, requireTls, sendGrantError } from './inferenceGrantAuth.js';

const router = express.Router();
router.use(requireGrantToken);
router.use(requireTls);

router.post('/', async (req, res) => {
  const grant = req.body && req.body.grant;
  try {
    const DEFAULT_BASE = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      google: 'https://generativelanguage.googleapis.com/v1beta',
      openrouter: 'https://openrouter.ai/api/v1',
    };
    const payload = await exchangeGrant(req.db, grant, async ({ secret, provider, baseUrl, credentialId }) => ({
      provider,
      baseUrl: baseUrl || DEFAULT_BASE[provider] || null,
      secret,
      credentialId,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return res.json(payload);
  } catch (e) { sendGrantError(res, e); }
});

export default router;
