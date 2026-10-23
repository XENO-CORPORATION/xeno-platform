/**
 * GET /api/comms/identity — XENO Comms' one validation URL (its XENO_COMMS_PLATFORM_AUTH_VALIDATE_URL).
 *
 * Comms verifies every bearer it receives by asking here, in both its API and its realtime gateway. Two kinds
 * of bearer arrive:
 *   - the workspace's 60-second assertion (typ xeno-comms-assertion+jwt, services/xenoComms.js): verified with the
 *     platform's own key, spent once, answered with the member's kind, owner and the signed workspace scope;
 *   - a person's own session token from a Comms app: answered exactly as GET /api/auth/validate answers it.
 * Anything else is 401. Mounted with databaseMiddleware only: the caller is Comms, not a signed-in browser.
 */
import express from 'express';
import { identityFor, isCommsAssertion } from '../services/xenoComms.js';

const router = express.Router();

router.get('/identity', async (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
  try {
    if (isCommsAssertion(token)) {
      const out = await identityFor(req.db, token);
      return out ? res.json(out) : res.status(401).json({ success: false, error: 'Invalid assertion' });
    }
    // loaded on use: authRoutes opens its Redis connection at import
    const { validateSession } = await import('./authRoutes.js');
    return validateSession(req, res);
  } catch (e) {
    console.error('[comms identity]', e);
    return res.status(500).json({ success: false, error: 'Validation failed' });
  }
});

export default router;
