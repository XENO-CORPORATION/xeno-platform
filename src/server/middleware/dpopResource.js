import { issuer } from '../config/hosts.js';
import { verifyDpopProof } from '../utils/dpop.js';

/** Shared resource-server proof boundary. Call only after verified authentication.
 * The public origin comes from locked host configuration, never Host/X-Forwarded-*.
 * Bound tokens cannot be replayed as Bearer tokens. Unbound legacy sessions keep
 * their existing authentication path; this does not authenticate cookies itself.
 */
export async function requireDpopIfBound(req, res, next) {
  if (!req.auth?.dpopJkt) return next();
  const match = /^DPoP\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  try {
    if (!match) throw Object.assign(new Error('DPoP authorization required'), { oauthError: 'invalid_dpop_proof' });
    await verifyDpopProof(req.db, {
      proof: String(req.headers.dpop || ''),
      method: req.method,
      // Express normalizes an empty router remainder to '/'. The original
      // request may have NO trailing slash; signing a different URI rejects
      // legitimate requests to /api/workspaces and /api/workspace-invites.
      url: `${issuer()}${(req.originalUrl || `${req.baseUrl}${req.path}`).split('?')[0]}`,
      accessToken: match[1],
      requiredJkt: req.auth.dpopJkt,
    });
    return next();
  } catch (error) {
    if (error.oauthError === 'invalid_dpop_proof') {
      res.set('WWW-Authenticate', 'DPoP error="invalid_dpop_proof"');
      return res.status(401).json({ success: false, error: 'invalid_dpop_proof', error_description: error.message });
    }
    // A replay-ledger outage is not proof success, and database details are private.
    return res.status(503).json({ success: false, error: 'authorization_unavailable' });
  }
}
