/**
 * /api/depot — what a signed-in PERSON does about XENO Depot on the platform (services/depotAuthority.js). Depot's own
 * gate uses /api/depot/authority instead; this is the person's side. Today: credentials for their headless agents
 * (xeno-depot decision 0001 §3, 0002 §2 — Runner reads Depot with one).
 *
 *   GET    /credentials              the caller's live agent credentials (never the secrets)
 *   POST   /credentials              { agentId, scopes?, label?, days? } → the new credential, secret shown ONCE
 *   DELETE /credentials/:id          revoke one
 *
 * Behind Depot's own door (staff-only until counsel clears the name), so the platform cannot be used to hand out
 * Depot access to someone Depot would refuse.
 */
import express from 'express';
import { resolvePrincipal } from '../services/agentIdentity.js';
import {
  DepotAuthorityError, actorForSession, doorFor, issueAgentCredential, listAgentCredentials, revokeAgentCredential,
} from '../services/depotAuthority.js';

const router = express.Router();

const handled = (fn) => async (req, res) => {
  try {
    res.set('cache-control', 'no-store');
    const me = await resolvePrincipal(req.db, req.user.id);
    const door = await doorFor(req.db, await actorForSession(req.db, req.user.id));
    if (!door.allowed) throw new DepotAuthorityError('door_closed', 403, door.message || 'XENO Depot is not open to this account');
    res.json({ success: true, ...(await fn(req, me)) });
  } catch (e) {
    if (e instanceof DepotAuthorityError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[depot]', e.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.get('/credentials', handled((req, me) => listAgentCredentials(req.db, me)));
router.post('/credentials', handled((req, me) => issueAgentCredential(req.db, me, req.body || {})));
router.delete('/credentials/:id', handled((req, me) => revokeAgentCredential(req.db, me, req.params.id)));

export default router;
